from rest_framework import generics, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Survey
from .pagination import SurveyPagination
from .serializers import SurveySerializer, SurveySyncSerializer
from .services import SurveyOwnershipConflict, soft_delete_survey, sync_survey


class SurveyListCreateView(generics.ListCreateAPIView):
    serializer_class = SurveySerializer
    parser_classes = [MultiPartParser, FormParser]
    pagination_class = SurveyPagination

    def get_queryset(self):
        return Survey.objects.filter(user=self.request.user, is_deleted=False)


class SurveyDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = SurveySerializer
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        # Scoping by owner here means a non-owner requesting another user's
        # survey id gets a plain 404, not a 403 that would leak the id's
        # existence.
        return Survey.objects.filter(user=self.request.user, is_deleted=False)

    def perform_destroy(self, instance):
        soft_delete_survey(instance)


class SurveySyncView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        serializer = SurveySyncSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)

        try:
            survey, created = sync_survey(user=request.user, **serializer.validated_data)
        except SurveyOwnershipConflict:
            return Response(
                {"detail": "This survey id is already associated with a different account."},
                status=status.HTTP_409_CONFLICT,
            )

        data = SurveySerializer(survey, context={"request": request}).data
        data["created"] = created
        return Response(data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
